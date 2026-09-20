plan "Holiday Let"

room bed1 "Bedroom 1" bedroom rect 0,0 3x3
room bed2 "Bedroom 2" bedroom rect 3,0 3x3
room living "Living Room" living rect 6,0 4x3
outdoor terrace "Terrace" covered rect 0,3 10x3

fixture shower in:terrace at 8.5,3.5 size 1x1 "Outdoor Shower"

door living>terrace w1.5 hinge:start swing:living glazed
door bed1>terrace w0.9 hinge:start swing:bed1
door bed2>terrace w0.9 hinge:start swing:bed2
