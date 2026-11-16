//! Пространственный хэш: быстрый поиск «кто рядом» без перебора всех игроков.

use std::collections::{HashMap, HashSet};

pub struct SpatialHash {
    cell_size: f32,
    // ячейка -> множество id в ней
    cells: HashMap<(i32, i32), HashSet<u32>>,
    // id -> (ячейка, мировые координаты)
    // Ячейка — для O(1) удаления при перемещении,
    // координаты — для точной проверки расстояния в query_radius.
    entries: HashMap<u32, ((i32, i32), (f32, f32))>,
}

impl SpatialHash {
    pub fn new(cell_size: f32) -> Self {
        Self { cell_size, cells: HashMap::new(), entries: HashMap::new() }
    }

    fn cell_of(&self, x: f32, z: f32) -> (i32, i32) {
        // floor() корректно обрабатывает отрицательные координаты:
        // -0.5 / 48.0 = -0.0104 → floor = -1, а не 0.
        ((x / self.cell_size).floor() as i32, (z / self.cell_size).floor() as i32)
    }

    pub fn insert(&mut self, id: u32, x: f32, z: f32) {
        let cell = self.cell_of(x, z);
        self.cells.entry(cell).or_default().insert(id);
        self.entries.insert(id, (cell, (x, z)));
    }

    pub fn remove(&mut self, id: u32) {
        if let Some((cell, _)) = self.entries.remove(&id) {
            if let Some(set) = self.cells.get_mut(&cell) {
                set.remove(&id);
                // Пустые ячейки убираем, чтобы HashMap не разрастался
                // по мере блуждания игроков по миру.
                if set.is_empty() { self.cells.remove(&cell); }
            }
        }
    }

    /// Обновить позицию. Возвращает true, если игрок сменил ячейку.
    pub fn update(&mut self, id: u32, x: f32, z: f32) -> bool {
        let new_cell = self.cell_of(x, z);
        match self.entries.get_mut(&id) {
            Some((old_cell, coords)) => {
                *coords = (x, z); // координаты обновляем всегда
                if *old_cell == new_cell { return false; }
                let old = *old_cell;
                *old_cell = new_cell;
                if let Some(set) = self.cells.get_mut(&old) {
                    set.remove(&id);
                    if set.is_empty() { self.cells.remove(&old); }
                }
                self.cells.entry(new_cell).or_default().insert(id);
                true
            }
            None => { self.insert(id, x, z); true }
        }
    }

    /// Кто в радиусе `radius` от (x, z), кроме `exclude_id`.
    pub fn query_radius(&self, x: f32, z: f32, radius: f32, exclude_id: u32) -> Vec<u32> {
        let center = self.cell_of(x, z);
        let span = (radius / self.cell_size).ceil() as i32; // при cell>=radius это 1
        let radius_sq = radius * radius;
        let mut result = Vec::new();
        for dx in -span..=span {
            for dz in -span..=span {
                if let Some(ids) = self.cells.get(&(center.0 + dx, center.1 + dz)) {
                    for &id in ids {
                        if id == exclude_id { continue; }
                        // Точная проверка: соседняя ячейка ≠ близко.
                        if let Some((_, (px, pz))) = self.entries.get(&id) {
                            let ddx = px - x;
                            let ddz = pz - z;
                            if ddx * ddx + ddz * ddz <= radius_sq {
                                result.push(id);
                            }
                        }
                    }
                }
            }
        }
        result
    }

    #[cfg(test)]
    pub fn len(&self) -> usize { self.entries.len() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_and_query() {
        let mut h = SpatialHash::new(48.0);
        h.insert(1, 0.0, 0.0);
        h.insert(2, 10.0, 10.0);
        h.insert(3, 200.0, 200.0);
        let near = h.query_radius(0.0, 0.0, 48.0, 0);
        assert!(near.contains(&1));
        assert!(near.contains(&2));
        assert!(!near.contains(&3));
    }

    #[test]
    fn exclude_self() {
        let mut h = SpatialHash::new(48.0);
        h.insert(1, 0.0, 0.0);
        h.insert(2, 5.0, 5.0);
        let near = h.query_radius(0.0, 0.0, 48.0, 1);
        assert!(!near.contains(&1));
        assert!(near.contains(&2));
    }

    #[test]
    fn move_between_cells() {
        let mut h = SpatialHash::new(48.0);
        h.insert(1, 10.0, 10.0);
        assert!(h.update(1, 100.0, 100.0));
        assert!(!h.query_radius(10.0, 10.0, 48.0, 0).contains(&1));
        assert!(h.query_radius(100.0, 100.0, 48.0, 0).contains(&1));
    }

    #[test]
    fn remove_cleans_up() {
        let mut h = SpatialHash::new(48.0);
        h.insert(1, 0.0, 0.0);
        h.remove(1);
        assert_eq!(h.len(), 0);
    }

    #[test]
    fn radius_filters_corners() {
        // Оба в ячейке (0,0), но расстояние ~66 > radius 10 — не должны найтись.
        let mut h = SpatialHash::new(48.0);
        h.insert(1, 47.0, 47.0);
        assert!(!h.query_radius(0.0, 0.0, 10.0, 0).contains(&1));
    }
}