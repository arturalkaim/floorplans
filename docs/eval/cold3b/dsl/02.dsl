plan "One-bedroom flat" walls 0.2/0.1

room hall "Hall" hall rect 0,0 1.5x4
room living "Living and kitchen" living rect 1.5,0 4x2
room bedroom "Bedroom" bedroom rect 1.5,2 4x1.3
room bath "Bathroom" bath rect 1.5,3.3 4x0.7

door hall.west w0.9 entrance
door hall>living @0.8 w0.9
door hall>bedroom @0.5 w0.8
door hall>bath @0.2 w0.7

window living.south w2
window bedroom.south w1.2
window bath.south w0.6
