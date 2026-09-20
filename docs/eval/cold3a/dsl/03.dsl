plan "Two-bedroom flat" walls 0.2/0.1

room corridor "Corridor" corridor rect 0,0 6x1.2 circulation
room bed1 "Bedroom 1" bedroom rect 0,1.2 2x3.3 habitable
room bed2 "Bedroom 2" bedroom rect 2,1.2 2x3.3 habitable
room bath "Bathroom" bath rect 4,1.2 2x3.3 wet
room living "Living room" living rect 6,0 2x4.5 habitable

door corridor.west w0.9 entrance
door corridor>bed1 at 1,1.2 w0.8
door corridor>bed2 at 3,1.2 w0.8
door corridor>bath at 5,1.2 w0.7
door corridor>living at 6,0.6 w0.9
window bed1.south w1.2
window bed2.south w1.2
window bath.south w0.6
window living.east w1.5
