//! Canonicalização de caminhos sem o prefixo `\\?\` do Windows.
//!
//! `std::fs::canonicalize` no Windows devolve caminhos verbatim (`\\?\C:\...`). Eles iam para
//! o histórico e para o yt-dlp/FFmpeg, e a validação de componentes recusava o prefixo,
//! marcando vídeos existentes como ausentes. `dunce` devolve `C:\...` quando isso é seguro e
//! é idêntico a `std::fs::canonicalize` nos outros sistemas.
use std::io;
use std::path::{Path, PathBuf};

pub trait Canonico {
    fn canonico(&self) -> io::Result<PathBuf>;
}

impl<P: AsRef<Path> + ?Sized> Canonico for P {
    fn canonico(&self) -> io::Result<PathBuf> {
        dunce::canonicalize(self.as_ref())
    }
}
