plan "Guest House"

room corridor "Corridor" corridor rect 6,0 1.2x12 circulation

room shower1 "Shower Room 1" wc rect 0,0 2x3
room bed1 "Bedroom 1" bedroom rect 2,0 4x3

room shower2 "Shower Room 2" wc rect 0,3 2x3
room bed2 "Bedroom 2" bedroom rect 2,3 4x3

room shower3 "Shower Room 3" wc rect 0,6 2x3
room bed3 "Bedroom 3" bedroom rect 2,6 4x3

room shower4 "Shower Room 4" wc rect 0,9 2x3
room bed4 "Bedroom 4" bedroom rect 2,9 4x3

door corridor>bed1 w0.8 hinge:start swing:bed1
door corridor>bed2 w0.8 hinge:start swing:bed2
door corridor>bed3 w0.8 hinge:start swing:bed3
door corridor>bed4 w0.8 hinge:start swing:bed4
door bed1>shower1 w0.7 hinge:end swing:shower1
door bed2>shower2 w0.7 hinge:end swing:shower2
door bed3>shower3 w0.7 hinge:end swing:shower3
door bed4>shower4 w0.7 hinge:end swing:shower4
