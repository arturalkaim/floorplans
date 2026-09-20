plan "Office Suite" units:m

level ground "Ground" ground

room reception "Reception" other rect 0,0 3x4.5
room corridor "Corridor" corridor rect 3,0 1.3x4.5 circulation
room office1 "Office 1" office rect 4.3,0 3x1.5
room office2 "Office 2" office rect 4.3,1.5 3x1.5
room meeting_room "Meeting Room" other rect 4.3,3 3x1.5

door corridor>reception w1.2 on:corridor.west
door corridor>office1 w0.9 on:corridor.east near:4.3,0.75
door corridor>office2 w0.9 on:corridor.east near:4.3,2.25
door corridor>meeting_room w0.9 on:corridor.east near:4.3,3.75
