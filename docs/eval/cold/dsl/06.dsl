plan "Bungalow" units:m

level ground "Ground" ground

room hall "Hall" hall rect 2,3 4x2 circulation
room bedroom1 "Bedroom 1" bedroom rect 2,0 2x3 habitable
room living "Living" living rect 4,0 2x3 habitable
room bedroom2 "Bedroom 2" bedroom rect 0,3 2x2 habitable
room bedroom3 "Bedroom 3" bedroom rect 6,3 2x2 habitable
room bathroom "Bathroom" bath rect 2,5 4x2 wet

door hall>bedroom1 w0.9 on:hall.north near:3,3
door hall>living w1.2 on:hall.north near:5,3
door hall>bedroom2 w0.9 on:hall.west
door hall>bedroom3 w0.9 on:hall.east
door hall>bathroom w0.8 on:hall.south
