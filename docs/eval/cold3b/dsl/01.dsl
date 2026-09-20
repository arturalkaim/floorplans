plan "Studio" walls 0.2/0.1

room studio "Studio" living rect 0,0 5x4
room shower "Shower room" bath rect 5,0 1.5x4

door studio>shower @1 w0.8 hinge:start swing:shower
door studio.south w0.9 entrance

fixture counter in:studio at 0.2,0.2 size 2x0.6 "Kitchenette"
fixture shower in:shower at 5.2,0.2 size 0.9x0.9 "Shower"
