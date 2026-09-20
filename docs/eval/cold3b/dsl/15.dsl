plan "Long narrow house" walls 0.2/0.1

room room1 "Hall" hall rect 0,0 2x3
room room2 "Living room" living rect 2,0 3x3
room room3 "Kitchen" kitchen rect 5,0 3x3
room room4 "Bedroom" bedroom rect 8,0 3x3
room room5 "Bathroom" bath rect 11,0 2x3

door room1.west w0.9 entrance
door room1>room2 @1 w0.9
door room2>room3 @1 w0.9
door room3>room4 @1 w0.8
door room4>room5 @1 w0.7

window room2.north w1.5
window room3.north w1.2
window room4.north w1.2
window room5.north w0.6
