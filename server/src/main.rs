mod spatial;
mod world;

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Router,
};
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMessage, ServerMessage};
use tokio::sync::mpsc;
use world::World;

static NEXT_PLAYER_ID: AtomicU32 = AtomicU32::new(1);

#[derive(Clone)]
struct AppState {
    // Arc<Mutex<World>>: единственная точка синхронизации.
    // Лок держим коротко и без .await внутри.
    world: Arc<Mutex<World>>,
}

#[tokio::main]
async fn main() {
    let state = AppState { world: Arc::new(Mutex::new(World::new())) };

    let app = Router::new().route("/ws", get(ws_handler)).with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    println!("Server running on ws://127.0.0.1:3000/ws");
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    let id = NEXT_PLAYER_ID.fetch_add(1, Ordering::Relaxed);
    println!("Client {} connected", id);

    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::channel::<Bytes>(64);
    // Клон Sender'а остаётся у нас и позволяет отправлять сообщения самому
    // клиенту через тот же канал — так мы сообщаем ему о его собственном
    // изменившемся обзоре. Оригинал уходит в World.
    let self_tx = tx.clone();

    // Welcome — до всех остальных сообщений, чтобы клиент знал свой id.
    let welcome = ServerMessage::Welcome { id };
    if sink.send(Message::Binary(Bytes::from(welcome.encode()))).await.is_err() {
        return;
    }

    // Регистрируемся в мире. Лок короткий, без .await.
    let join = state.world.lock().unwrap().join(id, tx);

    // Новому клиенту — состояния соседей.
    for (nid, nx, ny, nz, nyaw) in join.neighbor_states {
        let msg = ServerMessage::PlayerUpdate { id: nid, x: nx, y: ny, z: nz, yaw: nyaw };
        if sink.send(Message::Binary(Bytes::from(msg.encode()))).await.is_err() {
            // Если не смогли доставить снапшот — корректно выходим.
            // (Не забыть очистку — она произойдёт ниже, но мы сейчас return,
            // поэтому дублируем leave здесь; либо делаем через RAII. Для прототипа
            // просто вызываем leave вручную.)
            let leave = state.world.lock().unwrap().leave(id);
            for tx in leave.notify_senders {
                let _ = tx.send(Bytes::from(ServerMessage::PlayerLeft { id }.encode())).await;
            }
            return;
        }
    }

    // Соседям — факт появления нового игрока.
    let spawn_bytes = Bytes::from(
        ServerMessage::PlayerUpdate { id, x: 0.0, y: 0.0, z: 0.0, yaw: 0.0 }.encode()
    );
    for tx in join.notify_senders {
        let _ = tx.send(spawn_bytes.clone()).await;
    }

    // Фоновый писатель: rx → sink.
    let writer = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if sink.send(Message::Binary(bytes)).await.is_err() { break; }
        }
    });

    // Читаем Move.
    while let Some(Ok(msg)) = stream.next().await {
        if let Message::Binary(data) = msg {
            if let Ok(ClientMessage::Move { x, y, z, yaw }) = ClientMessage::decode(&data) {
                let result = state.world.lock().unwrap().move_to(id, x, y, z, yaw);
                let update_bytes = Bytes::from(
                    ServerMessage::PlayerUpdate { id, x, y, z, yaw }.encode()
                );
                let left_bytes = Bytes::from(ServerMessage::PlayerLeft { id }.encode());

                for tx in result.update_senders {
                    let _ = tx.send(update_bytes.clone()).await;
                }
                for tx in result.leave_senders {
                    let _ = tx.send(left_bytes.clone()).await;
                }

                // NEW: синхронизируем собственный обзор A.
                for (nid, nx, ny, nz, nyaw) in result.view_gained {
                    let msg = ServerMessage::PlayerUpdate { id: nid, x: nx, y: ny, z: nz, yaw: nyaw };
                    let _ = self_tx.send(Bytes::from(msg.encode())).await;
                }
                for nid in result.view_lost {
                    let msg = ServerMessage::PlayerLeft { id: nid };
                    let _ = self_tx.send(Bytes::from(msg.encode())).await;
                }
            }
        }
    }

    // Отключение.
    writer.abort();
    let leave = state.world.lock().unwrap().leave(id);
    let left_bytes = Bytes::from(ServerMessage::PlayerLeft { id }.encode());
    for tx in leave.notify_senders {
        let _ = tx.send(left_bytes.clone()).await;
    }

    println!("Client {} disconnected", id);
}