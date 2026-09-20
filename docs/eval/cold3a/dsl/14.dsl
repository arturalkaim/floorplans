plan "Office suite" walls 0.2/0.1

room reception "Reception" other rect 0,0 2.5x3.6 habitable
room corridor "Corridor" corridor rect 2.5,1.2 5.5x1.2 circulation
room office1 "Office 1" office rect 2.5,0 2.75x1.2 habitable
room office2 "Office 2" office rect 5.25,0 2.75x1.2 habitable
room meeting "Meeting room" office rect 2.5,2.4 5.5x1.2 habitable

door reception.west w0.9 entrance
door reception>corridor at 2.5,1.8 w0.9
door corridor>office1 at 3.875,1.2 w0.8
door corridor>office2 at 6.625,1.2 w0.8
door corridor>meeting at 5.25,2.4 w0.9
window office1.north w1.2
window office2.north w1.2
window meeting.south w1.5
window reception.west @1.6 w0.6
