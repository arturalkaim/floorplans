plan "Studio"

room studio "Studio" living rect 0,0 5x4
room shower "Shower Room" wc rect 5,0 1.5x4

fixture kitchenette in:studio at 0.2,0.2 size 2x0.6 "Kitchenette"

door studio.south at:2,4 w0.9 entrance
door studio>shower w0.8 hinge:start swing:shower
