plan "Two-Bedroom Flat" units:m

level ground "Ground" ground

room bedroom1 "Bedroom 1" bedroom rect 0,0 3x3 habitable
room bedroom2 "Bedroom 2" bedroom rect 0,3 3x3 habitable
room corridor "Corridor" corridor rect 3,0 1.3x6 circulation
room bathroom "Bathroom" bath rect 4.3,0 2x2 wet
room living "Living" living rect 0,6 7.3x4 habitable

door corridor>bedroom1 w0.9 on:corridor.west near:3,1.5
door corridor>bedroom2 w0.9 on:corridor.west near:3,4.5
door corridor>bathroom w0.8 on:corridor.east
door corridor>living w1.2 on:corridor.south
