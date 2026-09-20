plan "Holiday Let" units:m

level ground "Ground" ground

room bedroom1 "Bedroom 1" bedroom rect 0,0 3x3 habitable
room bedroom2 "Bedroom 2" bedroom rect 0,3 3x3 habitable
room living "Living" living rect 3,0 4x6 habitable

outdoor terrace "Terrace" covered rect 7,0 3x6

fixture shower in:terrace at 7.5,0.5 size 1x1 "Outdoor Shower" id:outdoor_shower

door bedroom1>living w0.9 on:bedroom1.east
door bedroom2>living w0.9 on:bedroom2.east
door living>terrace w1.8 on:living.east
