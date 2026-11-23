//! 运行时状态持久化模块：管理 <plugin_root>/state.json 的读取、默认初始化与原子写入。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::paths;

/// 当前动态引导器协议版本
pub const LOADER_VERSION: u32 = 1;

/// 当前二进制内置打包的客户端版本号
pub const BUNDLED_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 插件运行状态与用户更新配置
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginState {
    /// 当前本地已安装的 client.js 版本号
    pub version: String,
    /// 当前本地引导器协议版本
    pub loader_version: u32,
    /// 是否开启自动检查并静默下载更新（默认开启）
    pub auto_update: bool,
    /// 可选自定义 GitHub Release 镜像前缀（如 https://gh-proxy.com/）
    pub mirror_prefix: String,
    /// 上次检查更新的 Unix 秒级时间戳
    pub last_check_at: u64,
    /// 已下载就绪、等待重启 Antigravity 生效的版本号
    #[serde(default)]
    pub pending_update_version: Option<String>,
    /// 待生效版本的更新摘要
    #[serde(default)]
    pub pending_update_notes: Option<String>,
    /// 本次更新是否同时升级了底层引导器（可能需要等待 app.asar 释放锁）
    #[serde(default)]
    pub pending_loader_upgrade: bool,
    /// 上一次由 SessionStart 钩子触发自动修复时的未修补文件指纹，用于去重避免重复弹出内联卡片
    #[serde(default)]
    pub last_repaired_fingerprint: Option<String>,
}

impl Default for PluginState {
    fn default() -> Self {
        Self {
            version: BUNDLED_VERSION.to_string(),
            loader_version: LOADER_VERSION,
            auto_update: true,
            mirror_prefix: String::new(),
            last_check_at: 0,
            pending_update_version: None,
            pending_update_notes: None,
            pending_loader_upgrade: false,
            last_repaired_fingerprint: None,
        }
    }
}

/// 获取当前 Unix 秒级时间戳
pub fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 从磁盘加载 state.json；若不存在或损坏则返回默认值
pub fn load_state() -> PluginState {
    load_state_from(&paths::state_json_path())
}

pub fn load_state_from(path: &Path) -> PluginState {
    let Ok(raw) = fs::read_to_string(path) else {
        return PluginState::default();
    };
    serde_json::from_str::<PluginState>(&raw).unwrap_or_default()
}

/// 原子保存 state.json（先写临时文件再 rename/覆盖）
pub fn save_state(state: &PluginState) -> Result<(), String> {
    save_state_to(&paths::state_json_path(), state)
}

pub fn save_state_to(path: &Path, state: &PluginState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建状态目录失败: {e}"))?;
    }
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("序列化 state.json 失败: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, format!("{json}\n")).map_err(|e| format!("写入临时状态文件失败: {e}"))?;
    if path.exists() {
        let _ = fs::remove_file(path);
    }
    fs::rename(&tmp, path).map_err(|e| format!("替换 state.json 失败: {e}"))?;
    Ok(())
}
