//! 构建脚本：在 Windows 目标上将 `installer/assets/app.ico` 编译为 PE 图标资源并链接到二进制文件。
//! 零额外 Cargo 依赖：优先调用 PATH 或 Windows SDK 中的 `rc.exe`（回退 `llvm-rc`）。

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=assets/app.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let manifest_dir = match env::var("CARGO_MANIFEST_DIR") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return,
    };
    let ico_path = manifest_dir.join("assets").join("app.ico");
    if !ico_path.exists() {
        return;
    }

    let out_dir = match env::var("OUT_DIR") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return,
    };

    let ico_escaped = ico_path.to_string_lossy().replace('\\', "/");
    let rc_content = format!(
        "1 ICON \"{}\"\n",
        ico_escaped
    );
    let rc_path = out_dir.join("app.rc");
    if fs::write(&rc_path, rc_content).is_err() {
        return;
    }

    let res_path = out_dir.join("app.res");
    if compile_rc(&rc_path, &res_path) && res_path.exists() {
        println!("cargo:rustc-link-arg-bins={}", res_path.display());
    }
}

fn compile_rc(rc_path: &Path, res_path: &Path) -> bool {
    if let Some(rc_exe) = find_rc_exe() {
        let status = Command::new(&rc_exe)
            .args([
                "/nologo",
                "/fo",
                &res_path.to_string_lossy(),
                &rc_path.to_string_lossy(),
            ])
            .status();
        if matches!(status, Ok(s) if s.success()) {
            return true;
        }
    }

    let llvm_status = Command::new("llvm-rc")
        .args([
            "/fo",
            &res_path.to_string_lossy(),
            &rc_path.to_string_lossy(),
        ])
        .status();
    matches!(llvm_status, Ok(s) if s.success())
}

fn find_rc_exe() -> Option<PathBuf> {
    if let Ok(status) = Command::new("rc.exe").arg("/?").output() {
        if status.status.success() || !status.stdout.is_empty() || !status.stderr.is_empty() {
            return Some(PathBuf::from("rc.exe"));
        }
    }

    let mut roots = Vec::new();
    if let Ok(pf86) = env::var("ProgramFiles(x86)") {
        roots.push(PathBuf::from(pf86).join("Windows Kits").join("10").join("bin"));
    }
    if let Ok(pf) = env::var("ProgramFiles") {
        roots.push(PathBuf::from(pf).join("Windows Kits").join("10").join("bin"));
    }

    let mut candidates = Vec::new();
    for root in roots {
        if let Ok(entries) = fs::read_dir(&root) {
            for entry in entries.flatten() {
                let path = entry.path().join("x64").join("rc.exe");
                if path.exists() {
                    candidates.push(path);
                }
            }
        }
    }
    candidates.sort();
    candidates.pop()
}
