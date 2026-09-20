plan "Two-bedroom flat" walls 0.2/0.1

room bedroom1 "Bedroom 1" bedroom rect 0,0 2.5x2
room bedroom2 "Bedroom 2" bedroom rect 2.5,0 2.5x2
room corridor "Corridor" corridor rect 0,2 5x1.2
room bath "Bathroom" bath rect 0,3.2 5x1
room living "Living room" living rect 5,0 3x4.2

door corridor.west w0.9 entrance
door corridor>bedroom1 @0.5 w0.8
door corridor>bedroom2 on:bedroom2.south @0.5 w0.8
door corridor>bath @1 w0.7
door corridor>living @0.3 w0.9

window bedroom1.north w1.2
window bedroom2.north w1.2
window bath.south w0.5
window living.east w2
