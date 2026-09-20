plan "One-bedroom flat" walls 0.2/0.1

room living "Living and kitchen" living rect 0,0 3x5 habitable
room hall "Hall" hall rect 3,0 1.2x5 circulation
room bedroom "Bedroom" bedroom rect 4.2,0 1.8x3 habitable
room bath "Bathroom" bath rect 4.2,3 1.8x2 wet

door hall.north w0.9 entrance
door hall>living w0.9 on:hall.west
door hall>bedroom at 4.2,1.5 w0.8
door hall>bath at 4.2,4 w0.7
window living.south w1.8
window bedroom.east w1.2
window bath.east w0.6

fixture counter in:living at 0.3,0.3 size 2x0.6 depth:0.6
fixture sink in:living at 2.5,0.3 size 0.5x0.5
fixture wc in:bath at 4.4,3.2 size 0.4x0.6
fixture shower in:bath at 5.1,3.2 size 0.8x0.8
