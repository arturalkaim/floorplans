plan "One-Bedroom Flat" units:m

level ground "Ground" ground

room living_kitchen "Living Kitchen" living rect 0,0 3x4 habitable
room hall "Hall" hall rect 3,0 1.3x4.8 circulation
room bedroom "Bedroom" bedroom rect 4.3,0 3.5x3 habitable
room bathroom "Bathroom" bath rect 4.3,3 2.2x1.8 wet

door hall>living_kitchen w0.9 on:hall.west
door hall>bedroom w0.9 on:hall.east near:4.3,1.5
door hall>bathroom w0.8 on:hall.east near:4.3,3.9
door hall.south w0.9 entrance id:front_door
