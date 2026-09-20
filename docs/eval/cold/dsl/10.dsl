plan "Guest House" units:m

level ground "Ground" ground

room corridor "Corridor" corridor rect 3,0 1.3x8 circulation
room bedroom1 "Bedroom 1" bedroom rect 4.3,0 3x2 habitable
room shower1 "Shower 1" bath rect 7.3,0 1.7x2 wet
room bedroom2 "Bedroom 2" bedroom rect 4.3,2 3x2 habitable
room shower2 "Shower 2" bath rect 7.3,2 1.7x2 wet
room bedroom3 "Bedroom 3" bedroom rect 4.3,4 3x2 habitable
room shower3 "Shower 3" bath rect 7.3,4 1.7x2 wet
room bedroom4 "Bedroom 4" bedroom rect 4.3,6 3x2 habitable
room shower4 "Shower 4" bath rect 7.3,6 1.7x2 wet

door corridor>bedroom1 w0.9 on:bedroom1.west
door bedroom1>shower1 w0.8 on:bedroom1.east
door corridor>bedroom2 w0.9 on:bedroom2.west
door bedroom2>shower2 w0.8 on:bedroom2.east
door corridor>bedroom3 w0.9 on:bedroom3.west
door bedroom3>shower3 w0.8 on:bedroom3.east
door corridor>bedroom4 w0.9 on:bedroom4.west
door bedroom4>shower4 w0.8 on:bedroom4.east
