plan "Courtyard House" units:m

level ground "Ground" ground

room room_north "Room North" living rect 3,0 4x3 habitable
room room_south "Room South" bedroom rect 3,7 4x3 habitable
room room_west "Room West" kitchen rect 0,3 3x4
room room_east "Room East" bedroom rect 7,3 3x4 habitable

outdoor courtyard "Courtyard" rect 3,3 4x4

door room_north>courtyard w1.5 on:room_north.south
door room_south>courtyard w1.5 on:room_south.north
door room_west>courtyard w1.5 on:room_west.east
door room_east>courtyard w1.5 on:room_east.west
