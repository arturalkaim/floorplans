plan "Bungalow" walls 0.3/0.12

room hall "Hall" hall rect 4,3 2.5x4
room sala "Living room" living rect 0,0 6.5x3
room q1 "Bedroom 1" bedroom rect 0,3 4x2
room q2 "Bedroom 2" bedroom rect 0,5 4x2
room q3 "Bedroom 3" bedroom rect 0,7 4x2
room banho "Bathroom" bath rect 4,7 2.5x2

door hall.east w0.9 entrance
door hall>sala w0.9 swing:sala
door hall>q1 w0.8 swing:q1
door hall>q2 w0.8 swing:q2
door hall>q3 w0.8 swing:q3
door hall>banho w0.7 swing:banho
window sala.north w2.2
window q1.west w1.4
window q2.west w1.4
window q3.west w1.4
window banho.south w0.6
