plan "Long narrow house" walls 0.2/0.1

room r1 "Living room" living rect 0,0 2.4x3 habitable
room r2 "Kitchen" kitchen rect 2.4,0 2.4x3 habitable
room r3 "Bedroom 1" bedroom rect 4.8,0 2.4x3 habitable
room r4 "Bedroom 2" bedroom rect 7.2,0 2.4x3 habitable
room r5 "Bathroom" bath rect 9.6,0 2.4x3 wet

door r1.west w0.9 entrance
door r1>r2 at 2.4,1.5 w0.9
door r2>r3 at 4.8,1.5 w0.9
door r3>r4 at 7.2,1.5 w0.8
door r4>r5 at 9.6,1.5 w0.7
window r1.north w1.2
window r2.south w1.2
window r3.north w1.2
window r4.south w1.2
window r5.north w0.6
