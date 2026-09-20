plan "Cottage With A Porch" units:m

level ground "Ground" ground

room living "Living" living rect 0,0 4x4 habitable
room kitchen "Kitchen" kitchen rect 4,0 3x4
room bedroom "Bedroom" bedroom rect 7,0 3x4 habitable

outdoor porch "Porch" covered rect 0,-1.5 10x1.5

door living>kitchen w0.9 on:living.east
door kitchen>bedroom w0.9 on:kitchen.east
door living>porch w1.5 on:living.south entrance id:porch_door
