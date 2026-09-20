plan "Two-Bedroom Flat"

room corridor "Corridor" corridor rect 3,0 1.2x6 circulation
room bed1 "Bedroom 1" bedroom rect 0,0 3x3
room bed2 "Bedroom 2" bedroom rect 0,3 3x3
room bathroom "Bathroom" wc rect 4.2,0 1.8x2
room living "Living Room" living rect 0,6 6x4

door corridor>bed1 w0.8 hinge:start swing:bed1
door corridor>bed2 w0.8 hinge:start swing:bed2
door corridor>bathroom w0.7 hinge:end swing:bathroom
door corridor>living w0.9 hinge:start swing:living
