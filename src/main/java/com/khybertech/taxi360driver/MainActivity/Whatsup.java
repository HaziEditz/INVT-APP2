package com.khybertech.taxi360driver.MainActivity;

import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationManager;
import android.support.design.widget.TabLayout;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentPagerAdapter;
import android.support.v4.view.ViewPager;
import android.support.v7.app.AppCompatActivity;
import android.os.Bundle;
import android.support.v7.widget.Toolbar;
import android.util.Log;
import android.widget.ListView;

import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.JobView.Fragments.Taximetter;
import com.khybertech.taxi360driver.R;

import java.util.ArrayList;
import java.util.List;

public class Whatsup extends AppCompatActivity  {

    ViewPager viewpager_jobview;
    Taximetter Taximtterobj;
    TabLayout tablayout_jobview;
    ViewPagerAdapter adapter;
    ListView listview;
    String selected = "dispatch";
    Intent intent;
    Toolbar toolbar_jobview;
    String companyId;
    int driverId;
    SharedPreferences pref;
    SharedPreferences.Editor edit;
    Location loc_tobesent_via_notification;
    String loc_string;
    LocationManager lMngr;
    Geocoder gc;
    int permissionCheckCoarseLoc = 0;
    String url_alert = "";//"http://webservices.360taxitaxi.co.nz/api/DriverApp/DriverAlertsUsers";

    StringRequest   postRequest;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_swipe);

        widgets();

        setUpViewPager();
        viewpager_jobview.addOnPageChangeListener(new ViewPager.OnPageChangeListener() {

            @Override
            public void onPageScrolled(int position, float positionOffset, int positionOffsetPixels) {



            }

            @Override
            public void onPageSelected(int position) {
                if(position==0){

                }
            }


            @Override
            public void onPageScrollStateChanged(int state) {

            }
        });


        setSupportActionBar(toolbar_jobview);
        intent = getIntent();
        viewpager_jobview.setOffscreenPageLimit(7);

    }
    public ViewPager viewPag(){
        return viewpager_jobview;
    }
    //pos1


    private void setUpViewPager() {

        adapter = new ViewPagerAdapter(getSupportFragmentManager());
        swipe s = new swipe();
        s.drawable  = getResources().getDrawable(R.drawable.shot1);
        adapter.addFrag(s,"");
        swipe s1 = new swipe();
        s1.drawable  = getResources().getDrawable(R.drawable.shot2);
        adapter.addFrag(s1,"");
        swipe s2 = new swipe();
        s2.drawable  = getResources().getDrawable(R.drawable.shot3);
        adapter.addFrag(s2,"");
        viewpager_jobview.setAdapter(adapter);
    }

    private void widgets() {
        viewpager_jobview = (ViewPager) findViewById(R.id.viewpager_jobview1);

    }



    class ViewPagerAdapter extends FragmentPagerAdapter{

        private final List<Fragment> mFragmentList = new ArrayList<>();
        private final List<String> mFragmentTitleList = new ArrayList<>();

        public ViewPagerAdapter(FragmentManager fm) {
            super(fm);
        }

        @Override
        public Fragment getItem(int position) {
            return mFragmentList.get(position);
        }

        @Override
        public int getCount() {
            return mFragmentList.size();
        }

        public void addFrag(Fragment fragment, String title) {
            mFragmentList.add(fragment);
            mFragmentTitleList.add(title);
            if(title.equalsIgnoreCase("Completed")){
                //  listview = (ListView) fragment.getView().findViewById(R.id.lv_fragment_completed);
            }
            Log.e("title:",title);

        }

        @Override
        public CharSequence getPageTitle(int position) {
            return mFragmentTitleList.get(position);
        }
    }


}
