plan "One-Bedroom Flat"

room hall "Hall" hall rect 2,0 1.5x4 circulation
room bedroom "Bedroom" bedroom rect 0,0 2x4
room bathroom "Bathroom" wc rect 3.5,0 1.5x1.5
room living "Living & Kitchen" living rect 3.5,1.5 4x2.5

door hall.north w0.9 entrance
door hall>bedroom w0.8 hinge:start swing:bedroom
door hall>bathroom w0.7 hinge:end swing:bathroom
door hall>living w0.9 hinge:start swing:living
