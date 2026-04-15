package com.khybertech.taxi360driver.MainActivity;


import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.drawable.Drawable;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;

import com.android.volley.toolbox.StringRequest;
import com.khybertech.taxi360driver.R;

/**
 * A simple {@link Fragment} subclass.
 */

public class swipe extends Fragment {

    RecyclerView rv_chatinbox;
    RecyclerView.LayoutManager rv_layoutManager;
    RecyclerView.Adapter rv_adapter;
    Context c;
    public Drawable drawable ;
    public ImageView imageView;
    SharedPreferences pref;

    public swipe() {
        // Required empty public constructor
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);



    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        View v = inflater.inflate(R.layout.fragment_swipe, container, false);

        imageView = (ImageView)v.findViewById(R.id.imageswipe);
        imageView.setImageDrawable(drawable);
     //   new loadInbox().execute();
        return v;
    }
    StringRequest postRequest;



}
