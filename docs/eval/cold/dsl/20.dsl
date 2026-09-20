plan "Semi-Detached With A Void" units:m

level ground "Ground" ground

room living "Living" living rect 0,0 3x5 habitable
room hall "Hall" hall rect 3,0 1.3x5 circulation
room kitchen "Kitchen" kitchen rect 4.3,0 3x5

door hall>living w0.9 on:hall.west
door hall>kitchen w0.9 on:hall.east
door hall.south w0.9 entrance id:front_door

level upper "Upper"

room landing "Landing" hall rect 3,0 1.3x5 circulation
room bathroom "Bathroom" bath rect 4.3,0 3x1.5 wet
room bedroom1 "Bedroom 1" bedroom rect 4.3,1.5 3x1.75 habitable
room bedroom2 "Bedroom 2" bedroom rect 4.3,3.25 3x1.75 habitable

void living_void "Living Void" rect 0,0 3x5

door landing>bathroom w0.8 on:landing.east near:4.3,0.75
door landing>bedroom1 w0.9 on:landing.east near:4.3,2.4
door landing>bedroom2 w0.9 on:landing.east near:4.3,4.1

stairs main_stair "Main Stair" up:38 risers:14
  at ground in:hall rect 3,0 1.3x2.5
