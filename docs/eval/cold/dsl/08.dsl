plan "Townhouse" units:m

level ground "Ground" ground

room hall "Hall" hall rect 3,0 1.3x6 circulation
room living "Living" living rect 0,0 3x3 habitable
room kitchen "Kitchen" kitchen rect 0,3 3x3

door hall>living w0.9 on:hall.west near:3,1.5
door hall>kitchen w0.9 on:hall.west near:3,4.5
door hall.south w0.9 entrance id:front_door

level upper "Upper"

room landing "Landing" hall rect 3,0 1.3x6 circulation
room bedroom1 "Bedroom 1" bedroom rect 0,0 3x3 habitable
room bedroom2 "Bedroom 2" bedroom rect 0,3 3x3 habitable
room bathroom "Bathroom" bath rect 4.3,0 2x3 wet

door landing>bedroom1 w0.9 on:landing.west near:3,1.5
door landing>bedroom2 w0.9 on:landing.west near:3,4.5
door landing>bathroom w0.8 on:landing.east

stairs main_stair "Main Stair" up:38 risers:14
  at ground in:hall rect 3,0 1.3x3
