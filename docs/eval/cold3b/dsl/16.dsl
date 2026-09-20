plan "House with a utility" walls 0.2/0.1

room living "Living room" living rect 0,0 4x4
room kitchen "Kitchen" kitchen rect 4,0 3x4
room utility "Utility" utility rect 4,4 3x1.5
outdoor yard "Yard" rect 0,4 4x4

door living.west w0.9 entrance
door living>kitchen @1 w0.9
door kitchen>utility @0.5 w0.8
door utility>yard @0.5 w0.9 hinge:start swing:yard

window kitchen.north w1.5
window utility.east w0.8
window living.south w2
