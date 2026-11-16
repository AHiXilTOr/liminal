//! Состояние мира: игроки + пространственный хэш.
//! Никакой сети здесь нет — только чистые вычисления, что удобно для тестов
//! и для будущего вынесения в отдельный шард-процесс.

use std::collections::{HashMap, HashSet};
use tokio::sync::mpsc;
use axum::body::Bytes;

use protocol::{CELL_SIZE, VIEW_RADIUS};
use crate::spatial::SpatialHash;

pub struct PlayerState {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub yaw: f32,  // NEW
    pub tx: mpsc::Sender<Bytes>,
}

pub struct World {
    players: HashMap<u32, PlayerState>,
    spatial: SpatialHash,
}

// Результаты операций: World не отправляет сам (это async),
// а возвращает, кому и что нужно отправить. main.rs сделает отправку.
pub struct JoinResult {
    // Теперь (id, x, y, z, yaw) — добавлен yaw.
    pub neighbor_states: Vec<(u32, f32, f32, f32, f32)>,
    pub notify_senders: Vec<mpsc::Sender<Bytes>>,
}

pub struct MoveResult {
    pub update_senders: Vec<mpsc::Sender<Bytes>>,
    pub leave_senders: Vec<mpsc::Sender<Bytes>>,
    pub view_gained: Vec<(u32, f32, f32, f32, f32)>, // + yaw
    pub view_lost: Vec<u32>,
}

pub struct LeaveResult {
    pub notify_senders: Vec<mpsc::Sender<Bytes>>,
}

impl World {
    pub fn new() -> Self {
        Self {
            players: HashMap::new(),
            spatial: SpatialHash::new(CELL_SIZE),
        }
    }

    pub fn join(&mut self, id: u32, tx: mpsc::Sender<Bytes>) -> JoinResult {
        self.spatial.insert(id, 0.0, 0.0);
        // Новый игрок появляется с yaw=0 (взгляд в -Z).
        self.players.insert(id, PlayerState { x: 0.0, y: 0.0, z: 0.0, yaw: 0.0, tx });

        let neighbor_ids = self.spatial.query_radius(0.0, 0.0, VIEW_RADIUS, id);

        let neighbor_states: Vec<_> = neighbor_ids.iter()
            .filter_map(|nid| self.players.get(nid).map(|p| (*nid, p.x, p.y, p.z, p.yaw)))
            .collect();

        let notify_senders: Vec<_> = neighbor_ids.iter()
            .filter_map(|nid| self.players.get(nid).map(|p| p.tx.clone()))
            .collect();

        JoinResult { neighbor_states, notify_senders }
    }

    pub fn move_to(&mut self, id: u32, x: f32, y: f32, z: f32, yaw: f32) -> MoveResult {
        let (old_x, old_z) = self.players.get(&id).map(|p| (p.x, p.z)).unwrap_or((0.0, 0.0));
        let old_neighbors = self.spatial.query_radius(old_x, old_z, VIEW_RADIUS, id);
        let old_set: HashSet<u32> = old_neighbors.iter().copied().collect();

        if let Some(p) = self.players.get_mut(&id) {
            p.x = x; p.y = y; p.z = z; p.yaw = yaw;
        }
        self.spatial.update(id, x, z);

        let new_neighbors = self.spatial.query_radius(x, z, VIEW_RADIUS, id);
        let new_set: HashSet<u32> = new_neighbors.iter().copied().collect();

        let update_senders = new_neighbors.iter()
            .filter_map(|nid| self.players.get(nid).map(|p| p.tx.clone()))
            .collect();

        let leave_senders = old_neighbors.iter().copied()
            .filter(|nid| !new_set.contains(nid))
            .filter_map(|nid| self.players.get(&nid).map(|p| p.tx.clone()))
            .collect();

        let view_gained: Vec<_> = new_neighbors.iter().copied()
            .filter(|nid| !old_set.contains(nid))
            .filter_map(|nid| self.players.get(&nid).map(|p| (nid, p.x, p.y, p.z, p.yaw)))
            .collect();

        let view_lost: Vec<u32> = old_neighbors.iter().copied()
            .filter(|nid| !new_set.contains(nid))
            .collect();

        MoveResult { update_senders, leave_senders, view_gained, view_lost }
    }

    pub fn leave(&mut self, id: u32) -> LeaveResult {
        let (px, pz) = self.players
            .get(&id)
            .map(|p| (p.x, p.z))
            .unwrap_or((0.0, 0.0));

        let neighbors = self.spatial.query_radius(px, pz, VIEW_RADIUS, id);

        self.spatial.remove(id);
        self.players.remove(&id);

        let notify_senders = neighbors
            .iter()
            .filter_map(|nid| self.players.get(nid).map(|p| p.tx.clone()))
            .collect();

        LeaveResult { notify_senders }
    }
}