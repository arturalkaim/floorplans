plan "Guest house" walls 0.3/0.12

room corredor "Corridor" corridor rect 0,0 14x1.4
room q1 "Room 1" bedroom rect 0,1.4 3.5x3
room q2 "Room 2" bedroom rect 3.5,1.4 3.5x3
room q3 "Room 3" bedroom rect 7,1.4 3.5x3
room q4 "Room 4" bedroom rect 10.5,1.4 3.5x3
room b1 "Shower 1" bath rect 0,4.4 3.5x1.8
room b2 "Shower 2" bath rect 3.5,4.4 3.5x1.8
room b3 "Shower 3" bath rect 7,4.4 3.5x1.8
room b4 "Shower 4" bath rect 10.5,4.4 3.5x1.8

door corredor.west w1 entrance
door corredor>q1 w0.8 swing:q1
door corredor>q2 w0.8 swing:q2
door corredor>q3 w0.8 swing:q3
door corredor>q4 w0.8 swing:q4
door q1>b1 w0.7 swing:b1
door q2>b2 w0.7 swing:b2
door q3>b3 w0.7 swing:b3
door q4>b4 w0.7 swing:b4
window q1.north w1.4
window q2.north w1.4
window q3.north w1.4
window q4.north w1.4
window b1.south w0.6
window b2.south w0.6
window b3.south w0.6
window b4.south w0.6

fixture shower in:b1 at 0.2,4.6 size 0.9x0.9
fixture shower in:b2 at 3.7,4.6 size 0.9x0.9
fixture shower in:b3 at 7.2,4.6 size 0.9x0.9
fixture shower in:b4 at 10.7,4.6 size 0.9x0.9
