fn main() {
    println!(
        "cargo:rustc-env=CLIPORA_TARGET={}",
        std::env::var("TARGET").expect("TARGET ausente")
    );
    tauri_build::build()
}
