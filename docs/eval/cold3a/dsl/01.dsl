plan "Studio" walls 0.2/0.1

room main "Studio room" living rect 0,0 4x4 habitable
room shower "Shower room" bath rect 4,0 1.5x4 wet

door exterior>main at 1.5,4 w0.9 hinge:start swing:main entrance id:front_door
door main>shower w0.8 on:main.east hinge:start swing:shower
window main.south @2.5 w1.5
window shower.east w0.6

fixture counter in:main at 0.3,0.3 size 2x0.6 depth:0.6 id:kitchenette_counter
fixture sink in:main at 2.5,0.3 size 0.6x0.6
fixture shower in:shower at 4.3,0.3 size 0.9x0.9
fixture wc in:shower at 4.3,1.5 size 0.4x0.6
