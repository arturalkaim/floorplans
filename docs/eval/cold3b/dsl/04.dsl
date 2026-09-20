plan "Cottage with a porch" walls 0.2/0.1

room living "Living room" living rect 0,0 3x4
room bedroom "Bedroom" bedroom rect 3,0 3x4
room kitchen "Kitchen" kitchen rect 6,0 3x4
outdoor porch "Porch" covered rect 0,4 9x1.5

door porch>living at 1.5,4 w1.5 entrance hinge:start swing:porch
door living>bedroom @1 w0.9
door bedroom>kitchen @1 w0.9

window living.north w1.5
window bedroom.north w1.2
window kitchen.north w1.5
