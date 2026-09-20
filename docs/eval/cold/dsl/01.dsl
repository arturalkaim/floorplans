plan "Studio" units:m

level ground "Ground" ground

room studio "Studio" living rect 0,0 5x4 habitable
room shower_room "Shower Room" bath rect 5,0 2x2 wet

fixture counter in:studio at 0.2,0.2 size 2x0.6 "Kitchenette" id:kitchenette

door studio>shower_room w0.8 on:studio.east
door studio.south w0.9 entrance id:front_door
