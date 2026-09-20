plan "House With A Utility" units:m

level ground "Ground" ground

room living "Living" living rect -4,0 4x3 habitable
room kitchen "Kitchen" kitchen rect 0,0 3x3
room utility "Utility" utility rect 3,0 2x3

outdoor yard "Yard" rect 3,3 2x3

door kitchen>living w0.9 on:kitchen.west
door kitchen>utility w0.9 on:kitchen.east
door utility>yard w0.9 on:utility.south entrance id:back_door
