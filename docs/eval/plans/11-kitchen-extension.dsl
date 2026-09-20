plan "Kitchen extension" walls 0.3/0.12

room cozinha "Kitchen" kitchen rect 0,0 6x4.5
room despensa "Larder" storage rect 6,0 1.6x4.5
outdoor terraco "Terrace" rect 0,4.5 7.6x3

door cozinha.north w0.9 entrance
door terraco>cozinha w1.8 glazed swing:cozinha
door cozinha>despensa w0.7 swing:despensa
window cozinha.west w1.6
window despensa.east w0.6

fixture counter in:cozinha at 0.2,0.2 size 5.4x0.6 "Run" depth:0.6
fixture island in:cozinha at 1.8,2 size 2.4x0.9
fixture sink in:cozinha at 2.5,0.2 size 0.8x0.6
