plan "Bungalow" walls 0.2/0.1

room bedroom1 "Bedroom 1" bedroom rect 0,0 3x3
room hall "Hall" hall rect 3,0 1.5x6
room bedroom2 "Bedroom 2" bedroom rect 4.5,0 3x3
room bedroom3 "Bedroom 3" bedroom rect 0,3 3x3
room bath "Bathroom" bath rect 4.5,3 3x3
room living "Living room" living rect 0,6 7.5x2

door hall>bedroom1 @1 w0.8
door hall>bedroom2 @1 w0.8
door hall>bedroom3 @1 w0.8
door hall>bath @1 w0.7
door hall>living @0.3 w0.9
door living.south w1 entrance

window bedroom1.north w1.2
window bedroom2.north w1.2
window bedroom3.west w1.2
window bath.east w0.6
window living.south w2
