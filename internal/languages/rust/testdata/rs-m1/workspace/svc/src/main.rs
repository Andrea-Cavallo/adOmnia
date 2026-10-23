//! Fixture RS-M1: il binario del workspace (dipende dalla lib `rs-m1-core`).

fn main() {
    println!("{}", rs_m1_core::greeting());
}
