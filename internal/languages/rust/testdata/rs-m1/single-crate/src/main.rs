//! Fixture RS-M1: crate singolo (solo bin). Serve a verificare apertura, Explorer e Run.

mod util;

fn main() {
    println!("rs-m1 single crate: {}", util::label());
}
