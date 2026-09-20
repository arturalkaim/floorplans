plan "Bungalow"

room hall "Hall" hall rect 3,3 3x3 circulation
room living "Living Room" living rect 3,0 3x3
room bed1 "Bedroom 1" bedroom rect 0,3 3x3
room bed2 "Bedroom 2" bedroom rect 6,3 3x3
room bed3 "Bedroom 3" bedroom rect 3,6 1.8x3
room bathroom "Bathroom" wc rect 4.8,6 1.2x3

door hall>living w0.9 hinge:start swing:living
door hall>bed1 w0.8 hinge:start swing:bed1
door hall>bed2 w0.8 hinge:start swing:bed2
door hall>bed3 w0.8 hinge:start swing:bed3
door hall>bathroom w0.7 hinge:end swing:bathroom
