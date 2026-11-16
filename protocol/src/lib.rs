//! Общие определения протокола для crowd_world: liminal.

use std::fmt;

// --- Теги ClientMessage ---
pub const TAG_MOVE: u8 = 0;

// --- Теги ServerMessage ---
pub const TAG_WELCOME: u8 = 0;
pub const TAG_PLAYER_UPDATE: u8 = 1;
pub const TAG_PLAYER_LEFT: u8 = 2;

// --- Размеры пакетов ---
pub const MOVE_SIZE: usize = 1 + 4 + 4 + 4 + 4;              // 17
pub const WELCOME_SIZE: usize = 1 + 4;                        // 5
pub const PLAYER_UPDATE_SIZE: usize = 1 + 4 + 4 + 4 + 4 + 4;  // 21
pub const PLAYER_LEFT_SIZE: usize = 1 + 4;                    // 5

// --- Пространственные константы ---
pub const VIEW_RADIUS: f32 = 48.0;
pub const CELL_SIZE: f32 = VIEW_RADIUS;

#[derive(Debug, Clone, Copy)]
pub enum ClientMessage {
    Move { x: f32, y: f32, z: f32, yaw: f32 },
}

#[derive(Debug, Clone, Copy)]
pub enum ServerMessage {
    Welcome { id: u32 },
    PlayerUpdate { id: u32, x: f32, y: f32, z: f32, yaw: f32 },
    PlayerLeft { id: u32 },
}

// --- Ошибки ---
#[derive(Debug)]
pub enum ProtocolError {
    TooShort { expected: usize, got: usize },
    UnknownTag(u8),
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProtocolError::TooShort { expected, got } => {
                write!(f, "message too short: expected {} bytes, got {}", expected, got)
            }
            ProtocolError::UnknownTag(tag) => write!(f, "unknown message tag: {}", tag),
        }
    }
}

impl std::error::Error for ProtocolError {}

impl ClientMessage {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            ClientMessage::Move { x, y, z, yaw } => {
                let mut buf = Vec::with_capacity(MOVE_SIZE);
                buf.push(TAG_MOVE);
                buf.extend_from_slice(&x.to_le_bytes());
                buf.extend_from_slice(&y.to_le_bytes());
                buf.extend_from_slice(&z.to_le_bytes());
                buf.extend_from_slice(&yaw.to_le_bytes());
                buf
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.len() < MOVE_SIZE {
            return Err(ProtocolError::TooShort { expected: MOVE_SIZE, got: bytes.len() });
        }
        match bytes[0] {
            TAG_MOVE => {
                let x = f32::from_le_bytes(bytes[1..5].try_into().unwrap());
                let y = f32::from_le_bytes(bytes[5..9].try_into().unwrap());
                let z = f32::from_le_bytes(bytes[9..13].try_into().unwrap());
                let yaw = f32::from_le_bytes(bytes[13..17].try_into().unwrap());
                Ok(ClientMessage::Move { x, y, z, yaw })
            }
            tag => Err(ProtocolError::UnknownTag(tag)),
        }
    }
}

impl ServerMessage {
    pub fn encode(&self) -> Vec<u8> {
        match self {
            ServerMessage::Welcome { id } => {
                let mut buf = Vec::with_capacity(WELCOME_SIZE);
                buf.push(TAG_WELCOME);
                buf.extend_from_slice(&id.to_le_bytes());
                buf
            }
            ServerMessage::PlayerUpdate { id, x, y, z, yaw } => {
                let mut buf = Vec::with_capacity(PLAYER_UPDATE_SIZE);
                buf.push(TAG_PLAYER_UPDATE);
                buf.extend_from_slice(&id.to_le_bytes());
                buf.extend_from_slice(&x.to_le_bytes());
                buf.extend_from_slice(&y.to_le_bytes());
                buf.extend_from_slice(&z.to_le_bytes());
                buf.extend_from_slice(&yaw.to_le_bytes());
                buf
            }
            ServerMessage::PlayerLeft { id } => {
                let mut buf = Vec::with_capacity(PLAYER_LEFT_SIZE);
                buf.push(TAG_PLAYER_LEFT);
                buf.extend_from_slice(&id.to_le_bytes());
                buf
            }
        }
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.is_empty() {
            return Err(ProtocolError::TooShort { expected: 1, got: 0 });
        }
        match bytes[0] {
            TAG_WELCOME => {
                if bytes.len() < WELCOME_SIZE {
                    return Err(ProtocolError::TooShort { expected: WELCOME_SIZE, got: bytes.len() });
                }
                Ok(ServerMessage::Welcome { id: u32::from_le_bytes(bytes[1..5].try_into().unwrap()) })
            }
            TAG_PLAYER_UPDATE => {
                if bytes.len() < PLAYER_UPDATE_SIZE {
                    return Err(ProtocolError::TooShort { expected: PLAYER_UPDATE_SIZE, got: bytes.len() });
                }
                let id = u32::from_le_bytes(bytes[1..5].try_into().unwrap());
                let x = f32::from_le_bytes(bytes[5..9].try_into().unwrap());
                let y = f32::from_le_bytes(bytes[9..13].try_into().unwrap());
                let z = f32::from_le_bytes(bytes[13..17].try_into().unwrap());
                let yaw = f32::from_le_bytes(bytes[17..21].try_into().unwrap());
                Ok(ServerMessage::PlayerUpdate { id, x, y, z, yaw })
            }
            TAG_PLAYER_LEFT => {
                if bytes.len() < PLAYER_LEFT_SIZE {
                    return Err(ProtocolError::TooShort { expected: PLAYER_LEFT_SIZE, got: bytes.len() });
                }
                Ok(ServerMessage::PlayerLeft { id: u32::from_le_bytes(bytes[1..5].try_into().unwrap()) })
            }
            tag => Err(ProtocolError::UnknownTag(tag)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn move_roundtrip() {
        let bytes = ClientMessage::Move { x: 1.0, y: 0.5, z: -2.0, yaw: 1.57 }.encode();
        assert_eq!(bytes.len(), MOVE_SIZE);
        match ClientMessage::decode(&bytes).unwrap() {
            ClientMessage::Move { x, y, z, yaw } => {
                assert_eq!((x, y, z, yaw), (1.0, 0.5, -2.0, 1.57));
            }
        }
    }

    #[test]
    fn welcome_roundtrip() {
        let bytes = ServerMessage::Welcome { id: 42 }.encode();
        match ServerMessage::decode(&bytes).unwrap() {
            ServerMessage::Welcome { id } => assert_eq!(id, 42),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn player_update_roundtrip() {
        let bytes = ServerMessage::PlayerUpdate { id: 7, x: 1.0, y: 0.0, z: -1.5, yaw: 0.7 }.encode();
        assert_eq!(bytes.len(), PLAYER_UPDATE_SIZE);
        match ServerMessage::decode(&bytes).unwrap() {
            ServerMessage::PlayerUpdate { id, x, y, z, yaw } => {
                assert_eq!((id, x, y, z, yaw), (7, 1.0, 0.0, -1.5, 0.7));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn player_left_roundtrip() {
        let bytes = ServerMessage::PlayerLeft { id: 99 }.encode();
        match ServerMessage::decode(&bytes).unwrap() {
            ServerMessage::PlayerLeft { id } => assert_eq!(id, 99),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn rejects_short_messages() {
        assert!(ClientMessage::decode(&[0u8; 3]).is_err());
        assert!(ServerMessage::decode(&[1u8; 3]).is_err());
    }
}