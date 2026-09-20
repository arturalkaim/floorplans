plan "Office suite" walls 0.2/0.1

room corridor "Corridor" corridor rect 3,0 1.2x5
room reception "Reception" other rect 0,0 3x2.5
room office1 "Office 1" office rect 0,2.5 3x2.5
room office2 "Office 2" office rect 4.2,0 3x2.5
room meeting "Meeting room" other rect 4.2,2.5 3x2.5

door corridor.north w0.9 entrance
door corridor>reception @0.5 w0.9
door corridor>office1 @0.5 w0.8
door corridor>office2 on:office2.west @0.5 w0.8
door corridor>meeting on:meeting.west @1.5 w0.8

window reception.west w1.5
window office1.west w1.2
window office2.east w1.2
window meeting.east w1.2
