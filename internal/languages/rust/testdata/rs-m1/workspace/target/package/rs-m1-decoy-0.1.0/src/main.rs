// DECOY RS-M1: questo crate vive dentro target/ (come i pacchetti estratti da cargo).
// NON deve comparire tra le unità: la detection salta target/ (RS-1.4).
fn main() {
    println!("se vedi questo come unita, target/ non e escluso");
}
