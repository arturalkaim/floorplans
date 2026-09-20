plan "Pool House" units:m

level ground "Ground" ground

room changing_room "Changing Room" other rect 0,0 3x3
room wc "WC" wc rect 3,0 1.5x1.5 wet

outdoor deck "Deck" rect 0,3 4.5x4

fixture pool in:deck at 0.75,4 size 3x2.5 "Pool" id:pool

door changing_room>deck at:1.5,3 w1.5
door changing_room>wc w0.8 on:changing_room.east
