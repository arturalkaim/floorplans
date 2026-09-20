plan "Long Narrow House" units:m

level ground "Ground" ground

room hall "Hall" hall rect 0,0 2x4 circulation
room living "Living" living rect 2,0 3x4 habitable
room kitchen "Kitchen" kitchen rect 5,0 3x4
room bedroom "Bedroom" bedroom rect 8,0 3x4 habitable
room bathroom "Bathroom" bath rect 11,0 2x4 wet

door hall.west w0.9 entrance id:front_door
door hall>living w0.9 on:hall.east
door living>kitchen w0.9 on:living.east
door kitchen>bedroom w0.9 on:kitchen.east
door bedroom>bathroom w0.8 on:bedroom.east
