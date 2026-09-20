plan "Bungalow" walls 0.2/0.1

room living "Living room" living rect 0,0 8x3 habitable
room hall "Hall" hall rect 3,3 1.5x5 circulation
room bed1 "Bedroom 1" bedroom rect 0,3 3x2.5 habitable
room bed2 "Bedroom 2" bedroom rect 0,5.5 3x2.5 habitable
room bed3 "Bedroom 3" bedroom rect 4.5,3 3.5x2.5 habitable
room bath "Bathroom" bath rect 4.5,5.5 3.5x2.5 wet

door living.north w1.0 entrance
door living>hall w0.9 on:hall.north
door hall>bed1 at 3,4.25 w0.8
door hall>bed2 at 3,6.75 w0.8
door hall>bed3 at 4.5,4.25 w0.8
door hall>bath at 4.5,6.75 w0.7
window living.north @3 w2
window bed1.west w1.2
window bed2.west w1.2
window bed3.east w1.2
window bath.east w0.6
