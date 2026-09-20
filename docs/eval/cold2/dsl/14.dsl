plan "Office Suite"

room corridor "Corridor" corridor rect 3,0 1.2x6 circulation
room reception "Reception" reception rect 0,0 3x3
room meeting "Meeting Room" meeting rect 0,3 3x3
room office1 "Office 1" office rect 4.2,0 3x3
room office2 "Office 2" office rect 4.2,3 3x3

door reception>corridor w0.9 hinge:start swing:corridor
door corridor>meeting w0.8 hinge:start swing:meeting
door corridor>office1 w0.8 hinge:start swing:office1
door corridor>office2 w0.8 hinge:start swing:office2
