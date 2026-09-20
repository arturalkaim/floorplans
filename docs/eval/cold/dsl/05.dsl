plan "Garage Workshop" units:m

level ground "Ground" ground

room garage "Garage" garage poly 0,0 6,0 6,4 4,4 4,6 0,6
room office "Office" office rect 4,4 2x2

door garage>office w0.9 on:office.west
door garage.south w2.4 entrance id:garage_door
