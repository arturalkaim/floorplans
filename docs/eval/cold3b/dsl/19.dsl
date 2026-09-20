plan "Holiday let" walls 0.2/0.1

room living "Living room" living rect 0,0 5x4
room bedroom1 "Bedroom 1" bedroom rect 5,0 3x4
room bedroom2 "Bedroom 2" bedroom rect 8,0 3x4
outdoor terrace "Terrace" covered rect 0,4 5x2

door living.west w0.9 entrance
door living>bedroom1 @1 w0.8
door bedroom1>bedroom2 @1 w0.8
door living>terrace @1 w1.8 hinge:start swing:terrace

fixture shower in:terrace at 0.5,4.3 size 1x1 "Outdoor shower" id:outdoorshower

window bedroom1.north w1.2
window bedroom2.north w1.2
window living.north w2
