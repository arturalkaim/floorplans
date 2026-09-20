plan "Kitchen extension" walls 0.2/0.1

room kitchen "Kitchen" kitchen rect 0,0 4x4
outdoor terrace "Terrace" rect 0,4 4x3

door kitchen>terrace @0.5 w2.4 glazed hinge:start swing:terrace
door kitchen.west w0.9 entrance

fixture counter in:kitchen at 0.2,0.2 size 3x0.6 depth:0.6 "Counter run" id:counter1

window kitchen.north w1.5
