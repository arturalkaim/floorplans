plan "Long Narrow House"

room room1 "Room 1" living rect 0,0 3x4
room room2 "Room 2" kitchen rect 3,0 3x4
room room3 "Room 3" bedroom rect 6,0 3x4
room room4 "Room 4" bedroom rect 9,0 3x4
room room5 "Room 5" wc rect 12,0 3x4

door room1.west w0.9 entrance
door room1>room2 w0.9 hinge:start swing:room2
door room2>room3 w0.8 hinge:start swing:room3
door room3>room4 w0.8 hinge:start swing:room4
door room4>room5 w0.7 hinge:end swing:room5
